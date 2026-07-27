import os
from typing import Literal

from pydantic import BaseModel


class ParserSettings(BaseModel):
    environment: Literal["development", "test", "production"] = "development"

    @classmethod
    def from_environment(cls) -> "ParserSettings":
        return cls(environment=os.getenv("PARSER_ENV", "development"))
