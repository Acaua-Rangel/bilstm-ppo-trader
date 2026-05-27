import asyncio
import time
import logging
from database import Database
from data_processor import DataProcessor
from model_loader import ModelLoader
from trade_executor import TradeExecutor
import os

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("VPS_Trader")

async def get_sleep_time_until_next_interval(minutes_interval: int):
    """
    Calcula quantos segundos faltam para o fechamento do próximo candle .
    Por segurança, adicionamos 5 segundos para garantir que a Binance já gerou o candle fechado.
    """
    current_time = time.time()
    seconds_in_interval = minutes_interval * 60
    # O tempo que passou desde o último intervalo exato
    remainder = current_time % seconds_in_interval
    # O tempo que falta para o próximo
    sleep_time = seconds_in_interval - remainder
    return sleep_time + 5.0

async def run_inference_cycle(processor, model_loader, executor):
    logger.info("== Iniciando Ciclo de Inferência ==")
    
    # 2. Coleta dados e gera features
    result = await processor.get_latest_features()
    if result is None:
        logger.warning("Falha na coleta de dados. Abortando ciclo.")
        return
        
    features, current_price, candle_info = result
    current_adx = candle_info.get('adx')

    # 3. Predição do modelo ML
    global_action = model_loader.predict(features, candle_info)
    logger.info(f"Sinal do Modelo: {global_action} | Preço: {current_price} | ADX: {current_adx}")

    # 4. Motor Assíncrono (Distribui para todas as contas)
    await executor.execute_signals(global_action, current_price, current_adx)

    logger.info("== Ciclo de Inferência Concluído ==")

async def main_loop():
    logger.info("Inicializando Motor VPS Trader...")
    
    # 1. Instancia Serviços
    db = Database()
    processor = DataProcessor()
    model_loader = ModelLoader()
    executor = TradeExecutor(db)
    
    await db.connect()

    sleep_time_minutes = 2
    mode = os.getenv("TRADER_MODE", "FULL").upper()
    
    try:
        if mode == "CRON":
            logger.info("Modo CRON ativado. Executando inferência instantânea única...")
            await run_inference_cycle(processor, model_loader, executor)
        else:
            logger.info(f"Sistema Online (Modo FULL). Loop contínuo a cada {sleep_time_minutes} minutos...")
            while True:
                sleep_sec = await get_sleep_time_until_next_interval(sleep_time_minutes)
                logger.info(f"Dormindo por {sleep_sec:.2f} segundos até o fechamento do próximo candle...")
                await asyncio.sleep(sleep_sec)
                await run_inference_cycle(processor, model_loader, executor)
                
    except KeyboardInterrupt:
        logger.info("Encerrando bot manualmente...")
    finally:
        await processor.close()
        await db.close()

if __name__ == "__main__":
    import sys
    if sys.platform == 'win32':
        # Necessário no Windows para evitar WinError 87 ao fazer conexões SSL assíncronas com o aiomysql
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main_loop())
