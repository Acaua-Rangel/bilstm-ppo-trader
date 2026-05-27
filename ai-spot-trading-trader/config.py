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
    
    # Caminhos possíveis para o modelo CNN-BiLSTM-MHA (forecaster), em ordem de preferência:
    # 1. Layout de export de produção  (`PY_OUT` no notebook):       models/forecaster.keras
    # 2. Layout de treino bruto do notebook Kaggle:                  models/bilstm/full_model.keras
    # 3. Variável de ambiente MODEL_PATH (override manual).
    _MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
    MODEL_CANDIDATES = [
        os.getenv("MODEL_PATH") if os.getenv("MODEL_PATH") else None,
        os.path.join(_MODELS_DIR, "forecaster.keras"),
        os.path.join(_MODELS_DIR, "bilstm", "full_model.keras"),
        os.path.join(_MODELS_DIR, "bilstm", "model.keras"),
    ]
    MODEL_CANDIDATES = [p for p in MODEL_CANDIDATES if p]

    # MODEL_PATH mantido para compatibilidade — aponta para o primeiro candidato existente
    # (ou para o primeiro caminho da lista se nada existir, só pra log dizer onde procurou).
    MODEL_PATH = next(
        (p for p in MODEL_CANDIDATES if os.path.exists(p)),
        MODEL_CANDIDATES[0],
    )
