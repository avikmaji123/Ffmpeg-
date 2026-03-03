# Use Node 20 to eliminate Supabase warnings and improve memory management
FROM node:20-bookworm

# Install core system dependencies required for video manipulation
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install the absolute latest version of yt-dlp directly from the source
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

# Set the working directory
WORKDIR /app

# Copy package configurations and install node modules
COPY package*.json ./
RUN npm install

# Copy the entire server logic and the 'bgm' folder
COPY . .

# Expose the port for Render routing
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
