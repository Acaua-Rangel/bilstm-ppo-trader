import aiomysql
import logging
from config import Config

logger = logging.getLogger(__name__)


# DDL espelhado das migrations do backend (.NET / Pomelo).
# Usado apenas como rede de segurança caso o backend ainda não tenha rodado.
_TABLE_DDL = {
    "ExchangeAccounts": """
        CREATE TABLE IF NOT EXISTS `ExchangeAccounts` (
            `Id` INT NOT NULL AUTO_INCREMENT,
            `BinanceUid` VARCHAR(100) NOT NULL,
            `EncryptedApiKey` VARCHAR(1000) NOT NULL,
            `EncryptedApiSecret` VARCHAR(1000) NOT NULL,
            `AllocatedBalance` DECIMAL(18,8) NOT NULL,
            `IsPaperTrading` TINYINT(1) NOT NULL,
            `IsActive` TINYINT(1) NOT NULL,
            PRIMARY KEY (`Id`)
        ) CHARACTER SET=utf8mb4;
    """,
    "Trades": """
        CREATE TABLE IF NOT EXISTS `Trades` (
            `Id` INT NOT NULL AUTO_INCREMENT,
            `BinanceUid` VARCHAR(100) NOT NULL,
            `Symbol` VARCHAR(50) NOT NULL,
            `Action` VARCHAR(20) NOT NULL,
            `Amount` DECIMAL(18,8) NOT NULL,
            `Price` DECIMAL(18,8) NOT NULL,
            `Timestamp` DATETIME(6) NOT NULL,
            `Type` VARCHAR(20) NOT NULL,
            `PnL` DECIMAL(18,8) NOT NULL,
            `Adx` DECIMAL(8,4) NULL,
            PRIMARY KEY (`Id`),
            INDEX `idx_trades_uid_ts` (`BinanceUid`, `Timestamp`)
        ) CHARACTER SET=utf8mb4;
    """,
}

# Garante que a coluna Adx exista mesmo em bancos criados antes dessa versão.
_TABLE_MIGRATIONS = [
    """
    ALTER TABLE `Trades`
    ADD COLUMN IF NOT EXISTS `Adx` DECIMAL(8,4) NULL
    """,
]


class Database:
    def __init__(self):
        self.pool = None

    async def _ensure_database_exists(self):
        """Conecta ao servidor MySQL sem selecionar DB e garante que o schema exista."""
        import ssl
        import os
        ssl_ctx = None
        if os.path.exists(Config.MYSQL_SSL_CA):
            ssl_ctx = ssl.create_default_context(cafile=Config.MYSQL_SSL_CA)
            ssl_ctx.check_hostname = False
        else:
            logger.warning("Certificado CA %s não encontrado. Conectando sem SSL forçado.", Config.MYSQL_SSL_CA)
            
        conn = await aiomysql.connect(
            host=Config.MYSQL_HOST,
            port=Config.MYSQL_PORT,
            user=Config.MYSQL_USER,
            password=Config.MYSQL_PASSWORD,
            ssl=ssl_ctx,
            autocommit=True,
        )
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{Config.MYSQL_DB}` "
                    f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
                )
            logger.info("Database '%s' verificado/criado.", Config.MYSQL_DB)
        finally:
            conn.close()

    async def _ensure_tables_exist(self):
        """Cria as tabelas usadas pelo trader caso ainda não existam."""
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                for name, ddl in _TABLE_DDL.items():
                    await cur.execute(ddl)
                    logger.info("Tabela '%s' verificada/criada.", name)
                for stmt in _TABLE_MIGRATIONS:
                    try:
                        await cur.execute(stmt)
                    except Exception as exc:
                        logger.warning("Migration ignorada: %s", exc)

    async def connect(self):
        await self._ensure_database_exists()
        import ssl
        import os
        ssl_ctx = None
        if os.path.exists(Config.MYSQL_SSL_CA):
            ssl_ctx = ssl.create_default_context(cafile=Config.MYSQL_SSL_CA)
            ssl_ctx.check_hostname = False
            
        self.pool = await aiomysql.create_pool(
            host=Config.MYSQL_HOST,
            port=Config.MYSQL_PORT,
            user=Config.MYSQL_USER,
            password=Config.MYSQL_PASSWORD,
            db=Config.MYSQL_DB,
            ssl=ssl_ctx,
            autocommit=True
        )
        await self._ensure_tables_exist()
        logger.info("Connected to MySQL database (SSL: %s).", "Yes" if ssl_ctx else "No")

    async def get_active_users(self):
        """Busca contas de usuários elegíveis para trade, separando reais de paper trading."""
        query = """
            SELECT Id AS ExchangeAccountID, BinanceUid AS BinanceUID,
                   EncryptedApiKey, EncryptedApiSecret,
                   AllocatedBalance, IsPaperTrading
            FROM ExchangeAccounts
            WHERE IsActive = 1 AND AllocatedBalance > 0
        """
        async with self.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query)
                return await cur.fetchall()

    async def save_trade(self, binance_uid, symbol, action, amount, price, is_paper, pnl=0.0, adx=None):
        """Salva a operação/decisão no banco. BUY/SELL movimentam posição; HOLD apenas registra a decisão do modelo."""
        trade_type = "PAPER" if is_paper else "REAL"
        # UTC_TIMESTAMP(6) garante que o registro use UTC, independente do fuso do servidor MySQL.
        # O backend interpreta este DATETIME como UTC ao serializar para o frontend.
        query = """
            INSERT INTO Trades (BinanceUid, Symbol, Action, Amount, Price, Timestamp, Type, PnL, Adx)
            VALUES (%s, %s, %s, %s, %s, UTC_TIMESTAMP(6), %s, %s, %s)
        """
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, (binance_uid, symbol, action, amount, price, trade_type, pnl, adx))

    async def get_last_trade(self, binance_uid, symbol, is_paper):
        """Busca a última operação real (BUY/SELL) do usuário para calcular PnL teórico. HOLDs são ignorados."""
        trade_type = "PAPER" if is_paper else "REAL"
        query = """
            SELECT Action, Amount, Price, Timestamp
            FROM Trades
            WHERE BinanceUid = %s AND Symbol = %s AND Type = %s AND Action IN ('BUY','SELL')
            ORDER BY Timestamp DESC
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query, (binance_uid, symbol, trade_type))
                return await cur.fetchone()

    async def close(self):
        if self.pool:
            self.pool.close()
            await self.pool.wait_closed()
            logger.info("MySQL connection closed.")
