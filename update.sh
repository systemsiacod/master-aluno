#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd ~/master-aluno
git pull
npm install
npm run build
pm2 restart master-aluno
