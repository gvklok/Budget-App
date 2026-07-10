from datetime import date

from sqlalchemy.orm import Session

import models


def get_current_date(db: Session) -> date:
    """Returns the simulated date if the dev overlay has set one, else the real
    system date. All backend logic that needs 'today' should go through this."""
    clock = db.query(models.AppClock).filter(models.AppClock.id == 1).first()
    if clock and clock.simulated_date:
        return date.fromisoformat(clock.simulated_date)
    return date.today()
