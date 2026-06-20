from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    otm_database_url: str = ""
    ta_worker_secret: str = ""
    ta_lookback_days: int = 504
