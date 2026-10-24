#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/Apps/decaid"
PLUGIN_DIR="$HOME/.local/share/decaid/plugins"

echo "=== Decaid Local Test Launcher ==="

# 1. Ensure plugin directory is linked
mkdir -p "$PLUGIN_DIR"
if [ ! -L "$PLUGIN_DIR/mqtt.reaplugin" ] && [ ! -d "$PLUGIN_DIR/mqtt.reaplugin" ]; then
    echo "Linking plugin into Decaid..."
    ln -s "$REPO_DIR/mqtt.reaplugin" "$PLUGIN_DIR/mqtt.reaplugin"
fi

# 2. Check/Start MQTT Broker
if docker info >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -q "^mosquitto-test$"; then
        if ! docker ps --format '{{.Names}}' | grep -q "^mosquitto-test$"; then
            echo "Starting existing Mosquitto container..."
            docker start mosquitto-test >/dev/null
        else
            echo "Mosquitto broker is already running."
        fi
    else
        echo "Creating and starting Mosquitto container on port 1883..."
        docker run -d --name mosquitto-test -p 1883:1883 eclipse-mosquitto:latest \
            sh -c "echo 'listener 1883 0.0.0.0' > /mosquitto/config/mosquitto.conf && echo 'allow_anonymous true' >> /mosquitto/config/mosquitto.conf && /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf" >/dev/null
    fi
else
    echo "Hinweis: Docker nicht aktiv, MQTT-Broker nicht automatisch gestartet."
fi

# 3. Check Decaid installation
if [ ! -f "$APP_DIR/AppRun" ]; then
    echo "Fehler: $APP_DIR/AppRun nicht gefunden!"
    exit 1
fi

# 4. Launch Decaid
echo "Starting Decaid..."
echo "WebUI: http://localhost:3000"
echo "API:   http://localhost:8080"
exec "$APP_DIR/AppRun" "$@"
