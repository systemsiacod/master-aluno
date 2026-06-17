#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd ~/master-aluno
npm install
npx playwright install-deps chromium
npx playwright install chromium
npm run build
pm2 start ecosystem.config.js
pm2 save
