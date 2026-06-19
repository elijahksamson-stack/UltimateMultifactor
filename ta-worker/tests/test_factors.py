import pytest
from app.factors import compute_x_var, InsufficientBars


def test_x_var_symmetric_dispersion_known_value():
    offs = [-2, 2, -1, 1, -3, 3, -2, 2, -1, 1, -3, 3, -2, 2, -1, 1, -3, 3, -2, 2]
    closes = [10.0 + o for o in offs]
    assert compute_x_var(closes) == pytest.approx(400.0, abs=10.0)


def test_x_var_all_on_one_side_returns_zero():
    closes = [float(c) for c in range(1, 21)]
    assert compute_x_var(closes) == pytest.approx(0.0, abs=1e-6)


def test_x_var_raises_on_too_few_bars():
    with pytest.raises(InsufficientBars):
        compute_x_var([1.0, 2.0, 3.0])


from app.factors import compute_y_var


def test_y_var_basic_ratio():
    assert compute_y_var(price=100.0, target=110.0, stop=95.0) == pytest.approx(2.0)


def test_y_var_zero_or_negative_risk_returns_zero():
    assert compute_y_var(price=100.0, target=110.0, stop=100.0) == 0.0
    assert compute_y_var(price=100.0, target=110.0, stop=105.0) == 0.0


def test_y_var_negative_reward_allowed_as_negative():
    assert compute_y_var(price=100.0, target=98.0, stop=95.0) == pytest.approx(-0.4)
