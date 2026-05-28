import asyncio
import base64
import logging
import ccxt.async_support as ccxt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from database import Database
from config import Config

logger = logging.getLogger(__name__)


def _decrypt_key(cipher_b64: str) -> str:
    """AES-256-GCM decrypt. Payload: base64(nonce[12] || tag[16] || ciphertext)."""
    blob = base64.b64decode(cipher_b64)
    nonce = blob[:12]
    tag = blob[12:28]
    ciphertext = blob[28:]
    key = base64.b64decode(Config.ENCRYPTION_KEY)
    aesgcm = AESGCM(key)
    # cryptography lib espera ciphertext || tag
    plaintext = aesgcm.decrypt(nonce, ciphertext + tag, None)
    return plaintext.decode("utf-8")


def _make_binance(api_key: str, api_secret: str) -> ccxt.binance:
    return ccxt.binance({
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
        "options": {"defaultType": "spot"},
    })


class TradeExecutor:
    def __init__(self, db: Database):
        self.db = db

    async def execute_signals(self, global_action: str, current_price: float):
        """
        Recebe o sinal global (BUY/SELL/HOLD) e o distribui para todos os usuários elegíveis.
        Todas as decisões (incluindo HOLD) são registradas no banco para gerar histórico no dashboard.
        """
        users = await self.db.get_active_users()
        if not users:
            logger.info("Nenhum usuário ativo. Sinal '%s' não foi registrado.", global_action)
            return

        logger.info("Distribuindo sinal '%s' (price=%s) para %d usuários.",
                    global_action, current_price, len(users))

        tasks = [self._process_user_trade(u, global_action, current_price) for u in users]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, res in enumerate(results):
            if isinstance(res, Exception):
                logger.error("Erro ao processar usuário %s: %s", users[i]["BinanceUID"], res)

    async def _process_user_trade(self, user: dict, global_action: str, current_price: float):
        binance_uid = user["BinanceUID"]
        is_paper = bool(user["IsPaperTrading"])
        allocated_balance = float(user["AllocatedBalance"])

        symbol = Config.TRADING_SYMBOL if is_paper else Config.BINANCE_SYMBOL
        last_trade = await self.db.get_last_trade(binance_uid, symbol, is_paper)
        current_position = last_trade["Action"] if last_trade else "SELL"

        if global_action == "HOLD":
            await self.db.save_trade(
                binance_uid, symbol, "HOLD",
                amount=0.0, price=current_price, is_paper=is_paper, pnl=0.0,
            )
            logger.debug("[%s] HOLD registrado para %s", "PAPER" if is_paper else "REAL", binance_uid)
            return

        if global_action == "BUY" and current_position != "BUY":
            if is_paper:
                amount = allocated_balance / current_price
                await self.db.save_trade(binance_uid, symbol, "BUY", amount, current_price, True, 0.0)
                logger.info("[PAPER] BUY %s | Qtd: %.6f a %.2f", binance_uid, amount, current_price)
            else:
                await self._real_buy(user, allocated_balance, current_price)

        elif global_action == "SELL" and current_position == "BUY":
            buy_price = float(last_trade["Price"])
            amount = float(last_trade["Amount"])
            if is_paper:
                pnl = (current_price - buy_price) * amount
                await self.db.save_trade(binance_uid, symbol, "SELL", amount, current_price, True, pnl)
                logger.info("[PAPER] SELL %s | PnL: %.4f USDT | Fechamento a %.2f", binance_uid, pnl, current_price)
            else:
                await self._real_sell(user, amount, buy_price, current_price)

        else:
            # Sinal incompatível com posição atual (ex.: SELL sem position, BUY já comprado).
            # Apenas loga — não grava no banco para não poluir o histórico com trades fantasmas.
            logger.debug("[%s] Sinal %s ignorado para %s (posição atual: %s)",
                         "PAPER" if is_paper else "REAL", global_action, binance_uid, current_position)

    async def _real_buy(self, user: dict, allocated_fdusd: float, ref_price: float):
        binance_uid = user["BinanceUID"]
        exchange = None
        try:
            api_key = _decrypt_key(user["EncryptedApiKey"])
            api_secret = _decrypt_key(user["EncryptedApiSecret"])
            exchange = _make_binance(api_key, api_secret)

            # quoteOrderQty = compra com valor fixo em FDUSD (preenchimento total pela Binance)
            order = await exchange.create_order(
                Config.BINANCE_SYMBOL, "market", "buy",
                None, None,
                {"quoteOrderQty": allocated_fdusd},
            )
            filled_btc = float(order.get("filled") or order.get("amount") or 0)
            avg_price = float(order.get("average") or order.get("price") or ref_price)

            await self.db.save_trade(binance_uid, Config.BINANCE_SYMBOL, "BUY",
                                     filled_btc, avg_price, False, 0.0)
            logger.info("[REAL] BUY %s | %.6f BTC @ %.2f FDUSD", binance_uid, filled_btc, avg_price)
        except Exception as exc:
            logger.error("[REAL BUY ERROR] %s: %s", binance_uid, exc)
            raise
        finally:
            if exchange:
                await exchange.close()

    async def _real_sell(self, user: dict, btc_amount: float, buy_price: float, ref_price: float):
        binance_uid = user["BinanceUID"]
        exchange = None
        try:
            api_key = _decrypt_key(user["EncryptedApiKey"])
            api_secret = _decrypt_key(user["EncryptedApiSecret"])
            exchange = _make_binance(api_key, api_secret)

            order = await exchange.create_market_sell_order(Config.BINANCE_SYMBOL, btc_amount)
            filled_btc = float(order.get("filled") or order.get("amount") or btc_amount)
            avg_price = float(order.get("average") or order.get("price") or ref_price)
            pnl = (avg_price - buy_price) * filled_btc

            await self.db.save_trade(binance_uid, Config.BINANCE_SYMBOL, "SELL",
                                     filled_btc, avg_price, False, pnl)
            logger.info("[REAL] SELL %s | PnL: %.4f FDUSD | Fechamento a %.2f", binance_uid, pnl, avg_price)
        except Exception as exc:
            logger.error("[REAL SELL ERROR] %s: %s", binance_uid, exc)
            raise
        finally:
            if exchange:
                await exchange.close()
