# flowstate-dashboard — Node-App + gws-cli (fuer Kalender/Mail-Zugriff via gemountetes Token)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates ffmpeg \
  && pip3 install --break-system-packages gws-cli \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Rechnungen als PDF (07.08.2026). Lukas verschickt PDFs, keine Word-Dateien —
# im Bestand liegt zu jeder .docx eine PDF im Unterordner "PDF", die er bisher
# von Hand exportiert hat. Ohne Wandler waere der ganze Ablauf auf halbem Weg
# stehengeblieben.
#
# Die Schriften sind kein Beiwerk: Carlito und Caladea haben dieselben
# Buchstabenbreiten wie Calibri und Cambria, Liberation dieselben wie Arial und
# Times. Fehlen sie, ersetzt LibreOffice die Schrift durch eine breitere, die
# Zeilen brechen anders um und die Rechnung sieht NICHT mehr aus wie Lukas'
# bisherige — genau das, was er ausdruecklich nicht will.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer-nogui fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV GWS_ENCRYPTION=none
EXPOSE 3000
CMD ["node", "server.js"]
