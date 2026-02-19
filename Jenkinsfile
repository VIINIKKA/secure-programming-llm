pipeline {
    agent any

    options {
        timestamps()
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
    }
}
