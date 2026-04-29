# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please send an e-mail to the maintainers. All security vulnerabilities will be promptly addressed.

## Secure Configuration

This project uses environment variables to manage sensitive information such as server credentials, API tokens, and database passwords.

### Guidelines for Handling Secrets:

1.  **Never commit `.env` files**: Ensure that your local `.env` file is never committed to the version control system. It is already included in `.gitignore`.
2.  **Use `.env.example` as a template**: When adding new environment variables, update `.env.example` with placeholders (e.g., `VARIABLE_NAME=YOUR_VALUE_HERE`).
3.  **Environment Variables in Scripts**: Scripts like `ssh_deploy.js` and `ssh_deploy_full.js` are configured to read credentials from environment variables using the `dotenv` package.
4.  **Required Variables**:
    *   `SERVER_IP`: The IP address of the deployment server.
    *   `SERVER_USER`: The username for SSH access (defaults to `root`).
    *   `SERVER_PASSWORD`: The password for SSH access. **Required for deployment scripts.**
    *   `GHCR_TOKEN`: GitHub Container Registry token for pulling/pushing images.

### Local Setup:

1.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Fill in the actual values in the `.env` file.
