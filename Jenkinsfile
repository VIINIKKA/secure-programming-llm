pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Backend Tests and SAST') {
            steps {
                sh '''
                    python3 -m venv .venv
                    . .venv/bin/activate
                    pip install --upgrade pip
                    pip install -r backend/requirements.txt bandit pip-audit
                    pytest -q backend/tests
                    bandit -q -r backend/app
                    pip-audit -r backend/requirements.txt
                '''
            }
        }

        stage('Frontend Tests and Audit') {
            steps {
                sh '''
                    cd frontend
                    npm ci
                    npm run test:run
                    npm audit --audit-level=high
                '''
            }
        }

        stage('Build Containers') {
            steps {
                sh 'docker compose build'
            }
        }

        stage('Deploy Staging VM') {
            when {
                branch 'master-staging'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: 'csc-vm-ssh',
                        keyFileVariable: 'SSH_KEY_FILE',
                        usernameVariable: 'DEPLOY_USER',
                    ),
                    string(credentialsId: 'csc-vm-host', variable: 'DEPLOY_HOST'),
                ]) {
                    sh '''
                        set -eu
                        DEPLOY_PATH="/home/${DEPLOY_USER}/secure-programming-llm"
                        ssh -i "${SSH_KEY_FILE}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" \
                          "set -eu; \
                           cd ${DEPLOY_PATH}; \
                           test -f .env || { echo '.env missing in ${DEPLOY_PATH}'; exit 1; }; \
                           git fetch origin ${BRANCH_NAME}; \
                           if git show-ref --verify --quiet refs/heads/${BRANCH_NAME}; then \
                             git checkout ${BRANCH_NAME}; \
                           else \
                             git checkout -B ${BRANCH_NAME} origin/${BRANCH_NAME}; \
                           fi; \
                           git reset --hard origin/${BRANCH_NAME}; \
                           docker compose up -d --build --remove-orphans; \
                           curl -fsS --retry 30 --retry-delay 2 --retry-all-errors http://localhost:8080/healthz >/dev/null || { \
                             echo 'Health check failed after retries'; \
                             docker compose ps; \
                             docker compose logs --tail=120 backend frontend; \
                             exit 1; \
                           }; \
                           docker compose ps"
                    '''
                }
            }
        }
    }
}
