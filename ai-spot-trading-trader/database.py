import aiomysql
import logging
from config import Config

logger = logging.getLogger(__name__)

class Database:
    def __init__(self):
        self.pool = None

    async def connect(self):
        self.pool = await aiomysql.create_pool(
            host=Config.MYSQL_HOST,
            port=Config.MYSQL_PORT,
            user=Config.MYSQL_USER,
            password=Config.MYSQL_PASSWORD,
            db=Config.MYSQL_DB,
            autocommit=True
        )
        logger.info("Connected to MySQL database.")

    async def get_active_users(self):
        """Busca contas de usuários elegíveis para trade, separando reais de paper trading."""
        query = """
            SELECT ExchangeAccountID, BinanceUID, EncryptedApiKey, EncryptedApiSecret, 
                   AllocatedBalance, IsPaperTrading 
            FROM ExchangeAccounts 
            WHERE IsActive = 1 AND AllocatedBalance > 0
        """
        async with self.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query)
                return await cur.fetchall()

    async def save_trade(self, binance_uid, symbol, action, amount, price, is_paper, pnl=0.0):
        """Salva a operação no banco de dados. Funciona para reais e simulações (Paper Trading)."""
        trade_type = "PAPER" if is_paper else "REAL"
        query = """
            INSERT INTO Trades (BinanceUID, Symbol, Action, Amount, Price, Timestamp, Type, PnL)
            VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s)
        """
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, (binance_uid, symbol, action, amount, price, trade_type, pnl))
                
    async def get_last_trade(self, binance_uid, symbol, is_paper):
        """Busca a última operação do usuário para podermos calcular o PnL teórico da próxima operação."""
        trade_type = "PAPER" if is_paper else "REAL"
        query = """
            SELECT Action, Amount, Price, Timestamp 
            FROM Trades
            WHERE BinanceUID = %s AND Symbol = %s AND Type = %s
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
