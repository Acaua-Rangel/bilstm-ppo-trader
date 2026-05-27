import asyncio
import time
import logging
from database import Database
from data_processor import DataProcessor
from model_loader import ModelLoader
from trade_executor import TradeExecutor

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

async def main_loop():
    logger.info("Inicializando Motor VPS Trader...")
    
    # 1. Instancia Serviços
    db = Database()
    processor = DataProcessor()
    model_loader = ModelLoader()
    executor = TradeExecutor(db)
    
    await db.connect()

    sleep_time_minutes = 2
    
    logger.info(f"Sistema Online e Integrado. Aguardando o ciclo de {sleep_time_minutes} minutos...")

    try:
        while True:
            sleep_sec = await get_sleep_time_until_next_interval(sleep_time_minutes)
            logger.info(f"Dormindo por {sleep_sec:.2f} segundos até o fechamento do próximo candle...")
            await asyncio.sleep(sleep_sec)
            
            logger.info("== Iniciando Ciclo de Inferência ==")
            
            # 2. Coleta dados e gera features (1, 128, 20)
            result = await processor.get_latest_features()
            if result is None:
                logger.warning("Falha na coleta de dados. Pulando ciclo.")
                continue
                
            features, current_price, current_adx = result

            # 3. Predição do modelo ML
            global_action = model_loader.predict(features)
            logger.info(f"Sinal do Modelo: {global_action} | Preço: {current_price} | ADX: {current_adx}")

            # 4. Motor Assíncrono (Distribui para todas as contas)
            await executor.execute_signals(global_action, current_price, current_adx)
            
            logger.info("== Ciclo de Inferência Concluído ==")
            
    except KeyboardInterrupt:
        logger.info("Encerrando bot manualmente...")
    finally:
        await processor.close()
        await db.close()

if __name__ == "__main__":
    asyncio.run(main_loop())
