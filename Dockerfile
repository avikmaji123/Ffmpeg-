# Use a highly stable Linux machine with Node.js 18
FROM node:18-bullseye

# Update the system and install the heavy-duty video tools:
# - ffmpeg: To crop, add borders, mix music, and burn subtitles
# - python3: Required to run yt-dlp
# - fonts-liberation: CRITICAL. Without this, FFmpeg cannot draw the subtitles!
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Download and install the absolute latest version of yt-dlp directly from GitHub
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

# Set the working directory inside the Render server
WORKDIR /app

# Copy your package.json first (this makes Render build faster on future updates)
COPY package*.json ./
RUN npm install

# Copy all your code, including server.js and your 'bgm' folder with the mp3 files
COPY . .

# Expose port 3000 so Render can send traffic to your API
EXPOSE 3000

# Start the Viral Video Engine
CMD ["node", "server.js"]
