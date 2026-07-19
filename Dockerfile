# flowstate-dashboard — Node-App + gws-cli (fuer Kalender/Mail-Zugriff via gemountetes Token)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && pip3 install --break-system-packages gws-cli \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV GWS_ENCRYPTION=none
EXPOSE 3000
CMD ["node", "server.js"]
