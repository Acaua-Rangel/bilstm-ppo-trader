import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Database
    MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT", 3306))
    MYSQL_USER = os.getenv("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
    MYSQL_DB = os.getenv("MYSQL_DB", "ai_spot_trading")

    # Trading config
    TRADING_SYMBOL = "BTC/FDUSD"
    TIMEFRAME = "15m"
    HORIZON = 4
    NUM_FEATURES = 20
    WINDOW_SIZE = 128
    
    # Path to Keras Model
    MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "bilstm", "full_model.keras")
