#!/bin/bash
# JellyProbe Deployment Script

set -e

echo "🔍 JellyProbe Deployment Script"
echo "================================"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting."; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "❌ Docker Compose is required but not installed. Aborting."; exit 1; }

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your Jellyfin server details"
    echo ""
    read -p "Enter Jellyfin URL (default: http://localhost:8096): " JELLYFIN_URL
    JELLYFIN_URL=${JELLYFIN_URL:-http://localhost:8096}
    
    read -sp "Enter Jellyfin API Key: " API_KEY
    echo ""
    
    read -p "Enter timezone (default: UTC, e.g. Europe/Berlin): " TZ_VALUE
    TZ_VALUE=${TZ_VALUE:-UTC}

    # Update .env file
    sed -i.bak "s|JELLYFIN_URL=.*|JELLYFIN_URL=$JELLYFIN_URL|" .env
    sed -i.bak "s|API_KEY=.*|API_KEY=$API_KEY|" .env
    sed -i.bak "s|TZ=.*|TZ=$TZ_VALUE|" .env
    rm .env.bak 2>/dev/null || true
    
    echo "✅ .env file configured"
    echo ""
else
    echo "✅ .env file already exists"
    echo ""
fi

# Create data directory
if [ ! -d data ]; then
    echo "📁 Creating data directory..."
    mkdir -p data
    echo "✅ Data directory created"
    echo ""
fi

# Ask user for deployment option
echo "Select deployment option:"
echo "1) Build and start (recommended for first time)"
echo "2) Start existing container"
echo "3) Rebuild and restart"
echo "4) Stop container"
echo "5) View logs"
echo ""
read -p "Enter option (1-5): " OPTION

case $OPTION in
    1)
        echo ""
        echo "🐳 Building and starting JellyProbe..."
        docker-compose up -d --build
        echo ""
        echo "✅ JellyProbe is starting up!"
        echo ""
        echo "Waiting for health check..."
        sleep 5
        ;;
    2)
        echo ""
        echo "🐳 Starting JellyProbe..."
        docker-compose up -d
        echo ""
        echo "✅ JellyProbe started!"
        ;;
    3)
        echo ""
        echo "🔄 Rebuilding and restarting JellyProbe..."
        docker-compose down
        docker-compose up -d --build
        echo ""
        echo "✅ JellyProbe rebuilt and restarted!"
        sleep 5
        ;;
    4)
        echo ""
        echo "🛑 Stopping JellyProbe..."
        docker-compose down
        echo ""
        echo "✅ JellyProbe stopped!"
        exit 0
        ;;
    5)
        echo ""
        echo "📜 Showing logs (Ctrl+C to exit)..."
        docker-compose logs -f jellyprobe
        exit 0
        ;;
    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac

# Check container status
echo "Checking container status..."
if docker ps | grep -q jellyprobe; then
    echo "✅ Container is running"
    
    # Try to get health status
    HEALTH=$(docker inspect jellyprobe --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
    echo "Health status: $HEALTH"
    
    if [ "$HEALTH" = "healthy" ]; then
        echo ""
        echo "🎉 JellyProbe is ready!"
        echo ""
        echo "📊 Dashboard: http://localhost:3000"
        echo "🏥 Health check: http://localhost:3000/health"
        echo ""
        echo "📝 Quick commands:"
        echo "  - View logs: docker-compose logs -f jellyprobe"
        echo "  - Stop: docker-compose down"
        echo "  - Restart: docker-compose restart"
        echo ""
        echo "📖 Documentation:"
        echo "  - README.md - Complete documentation"
        echo "  - QUICKSTART.md - Setup guide"
        echo "  - SUMMARY.md - Feature overview"
        echo ""
    elif [ "$HEALTH" = "starting" ]; then
        echo ""
        echo "⏳ Container is starting up (may take 30-40 seconds)..."
        echo "Run 'docker-compose logs -f jellyprobe' to monitor progress"
        echo ""
    else
        echo ""
        echo "⚠️  Health check pending or unavailable"
        echo "Run 'docker-compose logs jellyprobe' to check for errors"
        echo ""
    fi
else
    echo "❌ Container is not running"
    echo "Run 'docker-compose logs jellyprobe' to see what went wrong"
    exit 1
fi
