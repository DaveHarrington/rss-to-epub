# Use the official Node.js 20.x image as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json (if available)
COPY package*.json ./

RUN npm install

RUN npx playwright install chromium
RUN npx playwright install-deps

COPY . .

CMD [ "node", "main.js" ]
