# notify-service

Sends transactional notifications (email, push) for order events.

## Setup

1. `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and fill in the SMTP credentials.
3. Run `python -m notify` to start the worker. It will recieve order events
   from the queue and dispatch notifications.

## Tests

`python -m pytest -q`
