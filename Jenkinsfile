// k6 performance gate for Jenkins.
// Needs on the agent: Node.js 18+ and either k6 or Docker.
// If any k6 threshold fails, `k6 run` exits non-zero (99) and the build fails.

pipeline {
  agent any

  parameters {
    string(name: 'CHECKOUT_EXTRA_MS', defaultValue: '0',
           description: 'Demo only: extra checkout delay in ms (1500 makes the gate fail)')
    booleanParam(name: 'USE_DOCKER', defaultValue: false,
                 description: 'Run k6 from the grafana/k6 Docker image instead of a local k6')
  }

  options {
    timeout(time: 10, unit: 'MINUTES')
  }

  stages {
    stage('Start app under test') {
      steps {
        sh '''
          CHECKOUT_EXTRA_MS=${CHECKOUT_EXTRA_MS} nohup node app/server.js > app.log 2>&1 &
          echo $! > app.pid
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && exit 0
            sleep 1
          done
          echo "App did not start"; cat app.log; exit 1
        '''
      }
    }

    stage('k6 performance gate') {
      steps {
        sh 'mkdir -p results'
        script {
          if (params.USE_DOCKER) {
            sh '''
              docker run --rm --network host -u "$(id -u):$(id -g)" \
                -v "$WORKSPACE:/work" -w /work grafana/k6 \
                run -e BASE_URL=http://localhost:3000 tests/load.js
            '''
          } else {
            sh 'k6 run -e BASE_URL=http://localhost:3000 tests/load.js'
          }
        }
      }
    }
  }

  post {
    always {
      sh 'kill $(cat app.pid) 2>/dev/null || true'
      archiveArtifacts artifacts: 'results/**, app.log', allowEmptyArchive: true
    }
    failure {
      echo 'Performance gate FAILED: see results/summary.md for which threshold broke.'
    }
  }
}
