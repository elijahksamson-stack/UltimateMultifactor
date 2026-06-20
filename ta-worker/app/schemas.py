from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class AnalyzeBatchRequest(BaseModel):
    tickers: list[str]
    lookback_days: int = 504

    @field_validator("tickers")
    @classmethod
    def _non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("tickers must be non-empty")
        return [t.strip().upper() for t in v]


class TickerResult(BaseModel):
    ticker: str
    x_var: float | None = Field(default=None)
    y_var: float | None = Field(default=None)
    z_var: int | None = Field(default=None)
    diagnostics: dict | None = None
    error: str | None = None


class AnalyzeBatchResponse(BaseModel):
    results: list[TickerResult]
