#!/bin/bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save || sudo iptables-save > /etc/iptables/rules.v4
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
pm2 status
curl -s http://localhost:3000 > /dev/null && echo "App is responding locally!"
