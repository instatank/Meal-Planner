#!/bin/bash
cd "/Users/ankitanand/Projects/meal-planner" || exit 1

BASE_PORT=5184
PORT="$BASE_PORT"

while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://127.0.0.1:${PORT}"

echo "Installing dependencies (safe to re-run)..."
npm install || {
  echo "npm install failed"
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
}

echo "Starting Meal Planner on ${URL}"
echo "Keep this Terminal window open while testing."
echo "Opening browser in 2 seconds..."
(sleep 2; open "$URL") &

npm run dev -- --host 127.0.0.1 --port "$PORT"

echo "Server stopped."
read -n 1 -s -r -p "Press any key to close..."
