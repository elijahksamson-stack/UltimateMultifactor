from __future__ import annotations

import asyncpg

PRICE_QUERY = """
    SELECT date, high, low, close
    FROM price_history
    WHERE ticker = $1
    ORDER BY date DESC
    LIMIT $2
"""


def rows_to_bars(rows: list[dict]) -> dict:
    """Convert newest-first DB rows to ascending float bar arrays."""
    ordered = list(reversed(rows))
    return {
        "highs": [float(r["high"]) for r in ordered],
        "lows": [float(r["low"]) for r in ordered],
        "closes": [float(r["close"]) for r in ordered],
    }


async def fetch_bars(pool: asyncpg.Pool, ticker: str, lookback_days: int) -> dict:
    rows = await pool.fetch(PRICE_QUERY, ticker, lookback_days)
    return rows_to_bars([dict(r) for r in rows])


async def make_pool(dsn: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=8)
