# Flowstate WhatsApp-Bruecke — eigener Container, isoliert vom Dashboard.
FROM node:22-bookworm-slim

# Baileys zieht 'libsignal' per git und kompiliert einen nativen Teil (node-gyp):
# git zum Holen, python3/make/g++ zum Bauen.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 make g++ ca-certificates \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "index.js"]
