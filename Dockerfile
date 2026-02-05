# Use a Node.js version that matches your dependencies (e.g., Node 20)
FROM node:20-slim

# Install ffmpeg AND the tools required to build native addons
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    python3 \
    tzdata \ 
    && rm -rf /var/lib/apt/lists/*

# Set the Timezone to IST
ENV TZ=Asia/Kolkata

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of your app's source code
COPY . .

# Run the build script to compile TypeScript to JavaScript
RUN npm run build

# Your app's start command (from package.json)
CMD [ "npm", "run", "start" ]