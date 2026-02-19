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

        stage('Frontend Audit') {
            steps {
                sh '''
                    cd frontend
                    npm ci
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
                        set -euo pipefail
                        DEPLOY_PATH="/home/${DEPLOY_USER}/secure-programming-llm"
                        ssh -i "${SSH_KEY_FILE}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" \
                          "set -euo pipefail; \
                           cd ${DEPLOY_PATH}; \
                           test -f .env || { echo '.env missing in ${DEPLOY_PATH}'; exit 1; }; \
                           git fetch origin ${BRANCH_NAME}; \
                           git checkout ${BRANCH_NAME}; \
                           git pull --ff-only origin ${BRANCH_NAME}; \
                           docker compose up -d --build --remove-orphans; \
                           curl -fsS http://localhost:8080/healthz >/dev/null; \
                           docker compose ps"
                    '''
                }
            }
        }
    }
}
