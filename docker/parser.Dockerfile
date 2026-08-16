FROM python:3.12-slim
WORKDIR /app
ARG RACIO_VERSION=0.0.0-dev
ENV RACIO_VERSION=$RACIO_VERSION
COPY pyproject.toml uv.lock* ./
RUN pip install --no-cache-dir uv && uv sync --no-dev
COPY src src
RUN addgroup --system racio && adduser --system --ingroup racio racio \
  && chown -R racio:racio /app
USER racio
CMD ["/app/.venv/bin/uvicorn", "racio_parser.main:app", "--app-dir", "/app/src", "--host", "0.0.0.0", "--port", "8001"]
