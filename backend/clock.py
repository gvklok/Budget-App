import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

import models

# The container runs in UTC; without this, "today" rolls over at 6pm Denver time.
APP_TZ = ZoneInfo(os.getenv("APP_TZ", "America/Denver"))


def get_current_date(db: Session) -> date:
    """Returns the simulated date if the dev overlay has set one, else the real
    date in APP_TZ. All backend logic that needs 'today' should go through this."""
    clock = db.query(models.AppClock).filter(models.AppClock.id == 1).first()
    if clock and clock.simulated_date:
        return date.fromisoformat(clock.simulated_date)
    return datetime.now(APP_TZ).date()
