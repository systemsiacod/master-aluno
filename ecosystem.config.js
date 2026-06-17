module.exports = {
  apps: [
    {
      name: 'master-aluno',
      script: 'npm',
      args: 'start',
      cwd: '/home/ubuntu/master-aluno',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
}
