import asyncio
import logging
from database import Database
from config import Config

logger = logging.getLogger(__name__)

class TradeExecutor:
    def __init__(self, db: Database):
        self.db = db

    async def execute_signals(self, global_action: str, current_price: float, adx: float | None = None):
        """
        Recebe o sinal global (BUY/SELL/HOLD) e o distribui para todos os usuários elegíveis.
        Todas as decisões (incluindo HOLD) são registradas no banco para gerar histórico no dashboard.
        """
        users = await self.db.get_active_users()
        if not users:
            logger.info("Nenhum usuário ativo. Sinal '%s' não foi registrado.", global_action)
            return

        logger.info("Distribuindo sinal '%s' (price=%s, adx=%s) para %d usuários.",
                    global_action, current_price, adx, len(users))

        tasks = [self._process_user_trade(u, global_action, current_price, adx) for u in users]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, res in enumerate(results):
            if isinstance(res, Exception):
                logger.error("Erro ao processar usuário %s: %s", users[i]['BinanceUID'], res)

    async def _process_user_trade(self, user: dict, global_action: str, current_price: float, adx: float | None):
        binance_uid = user['BinanceUID']
        is_paper = bool(user['IsPaperTrading'])
        allocated_balance = float(user['AllocatedBalance'])

        last_trade = await self.db.get_last_trade(binance_uid, Config.TRADING_SYMBOL, is_paper)
        current_position = last_trade['Action'] if last_trade else "SELL"

        if global_action == "HOLD":
            # HOLD não movimenta posição — só registra a decisão do modelo para o histórico.
            await self.db.save_trade(
                binance_uid, Config.TRADING_SYMBOL, "HOLD",
                amount=0.0, price=current_price, is_paper=is_paper, pnl=0.0, adx=adx,
            )
            logger.debug("[%s] HOLD registrado para %s | adx=%s", "PAPER" if is_paper else "REAL", binance_uid, adx)
            return

        if global_action == "BUY" and current_position != "BUY":
            amount = allocated_balance / current_price
            if is_paper:
                await self.db.save_trade(binance_uid, Config.TRADING_SYMBOL, "BUY", amount, current_price, True, 0.0, adx)
                logger.info("[PAPER] BUY %s | Qtd: %.6f a %.2f", binance_uid, amount, current_price)
            else:
                self._mock_real_trade(binance_uid, "BUY", amount, current_price)

        elif global_action == "SELL" and current_position == "BUY":
            buy_price = float(last_trade['Price'])
            amount = float(last_trade['Amount'])
            pnl = (current_price - buy_price) * amount
            if is_paper:
                await self.db.save_trade(binance_uid, Config.TRADING_SYMBOL, "SELL", amount, current_price, True, pnl, adx)
                logger.info("[PAPER] SELL %s | PnL: %.2f FDUSD | Fechamento a %.2f", binance_uid, pnl, current_price)
            else:
                self._mock_real_trade(binance_uid, "SELL", amount, current_price)

        else:
            # Sinal incompatível com a posição (ex: BUY quando já está comprado). Apenas registra.
            await self.db.save_trade(
                binance_uid, Config.TRADING_SYMBOL, global_action,
                amount=0.0, price=current_price, is_paper=is_paper, pnl=0.0, adx=adx,
            )

    def _mock_real_trade(self, binance_uid: str, action: str, amount: float, price: float):
        logger.warning(
            "[REAL TRADE BLOCKED] tentativa %s %s para %s. Operações reais estão bloqueadas durante o Beta.",
            action, amount, binance_uid,
        )
