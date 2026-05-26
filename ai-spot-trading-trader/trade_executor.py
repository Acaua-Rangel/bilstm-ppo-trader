import asyncio
import logging
from database import Database
from config import Config

logger = logging.getLogger(__name__)

class TradeExecutor:
    def __init__(self, db: Database):
        self.db = db

    async def execute_signals(self, global_action: str, current_price: float):
        """
        Recebe o sinal global (BUY/SELL/HOLD) e o distribui para todos os usuários elegíveis de forma concorrente.
        """
        if global_action == "HOLD":
            logger.info("Ação global é HOLD. Nenhuma operação será executada neste ciclo.")
            return

        users = await self.db.get_active_users()
        if not users:
            logger.info("Nenhum usuário ativo para executar trades no momento.")
            return

        logger.info(f"Distribuindo sinal de {global_action} para {len(users)} usuários.")
        
        # Prepara a execução assíncrona para todos os usuários ao mesmo tempo
        tasks = []
        for user in users:
            tasks.append(self._process_user_trade(user, global_action, current_price))
            
        # Executa paralelamente
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Loga erros eventuais
        for i, res in enumerate(results):
            if isinstance(res, Exception):
                logger.error(f"Erro ao processar usuário {users[i]['BinanceUID']}: {res}")

    async def _process_user_trade(self, user: dict, global_action: str, current_price: float):
        binance_uid = user['BinanceUID']
        is_paper = bool(user['IsPaperTrading'])
        allocated_balance = float(user['AllocatedBalance'])
        
        # Busca o estado atual do usuário
        last_trade = await self.db.get_last_trade(binance_uid, Config.TRADING_SYMBOL, is_paper)
        current_position = last_trade['Action'] if last_trade else "SELL" # Padrão sem posição (apenas Fiat)

        if global_action == "BUY" and current_position != "BUY":
            # Realizar Compra
            amount = allocated_balance / current_price
            pnl = 0.0 # Sem PnL na compra, apenas registra o trade
            
            if is_paper:
                await self.db.save_trade(binance_uid, Config.TRADING_SYMBOL, "BUY", amount, current_price, True, pnl)
                logger.info(f"[PAPER] BUY registrado para {binance_uid} | Qtd: {amount:.6f} a {current_price}")
            else:
                self._mock_real_trade(binance_uid, "BUY", amount, current_price)

        elif global_action == "SELL" and current_position == "BUY":
            # Realizar Venda
            buy_price = float(last_trade['Price'])
            amount = float(last_trade['Amount'])
            
            # PnL Teórico (Venda - Compra) * Quantidade
            # Como a exchange isenta taxas para BTC/FDUSD, não descontamos spread de taxa aqui.
            pnl = (current_price - buy_price) * amount
            
            if is_paper:
                await self.db.save_trade(binance_uid, Config.TRADING_SYMBOL, "SELL", amount, current_price, True, pnl)
                logger.info(f"[PAPER] SELL registrado para {binance_uid} | PnL: {pnl:.2f} FDUSD | Fechamento a {current_price}")
            else:
                self._mock_real_trade(binance_uid, "SELL", amount, current_price)

    def _mock_real_trade(self, binance_uid: str, action: str, amount: float, price: float):
        """
        Pré-modelado para Execução Real. Conforme o requerimento do usuário:
        "o sistema de aplicar dinheiro real não deve ser criado ainda, somente simular com dinheiro fictício"
        """
        logger.warning(f"[REAL TRADE BLOCKED] O sistema tentou executar um trade {action} real para {binance_uid}. "
                       f"Operações reais estão bloqueadas durante o Beta. "
                       f"Código de integração CCXT POST ONLY seria ativado aqui para zero taxas BTC/FDUSD.")
        # Futura implementação: 
        # 1. Descriptografar API Key e Secret
        # 2. Inicializar ccxt.binance({apiKey, secret})
        # 3. exchange.create_order('BTC/FDUSD', 'limit', action.lower(), amount, price, {'postOnly': True})
