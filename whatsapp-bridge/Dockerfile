# Flowstate WhatsApp-Bruecke — eigener Container, isoliert vom Dashboard.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "index.js"]
