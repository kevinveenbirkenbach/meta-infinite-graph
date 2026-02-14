ARG BASE_IMAGE=ghcr.io/kevinveenbirkenbach/infinito-debian:latest
FROM ${BASE_IMAGE}

SHELL ["/bin/bash", "-o", "pipefail", "-lc"]
ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/opt/venvs/infinito/bin:${PATH}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

RUN test -x /opt/venvs/infinito/bin/infinito \
 && ln -sf /opt/venvs/infinito/bin/infinito /usr/local/bin/infinito

RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default
COPY nginx.conf /etc/nginx/sites-available/mig.conf
RUN ln -s /etc/nginx/sites-available/mig.conf /etc/nginx/sites-enabled/mig.conf

WORKDIR /usr/share/nginx/html
COPY index.html ./
COPY app.js ./
COPY dataLoader.js ./
COPY selectionManager.js ./
COPY autoResolver.js ./
COPY graphRenderer.js ./
COPY uiManager.js ./
COPY styles.css ./

RUN set -euo pipefail; \
  MIG_WEB_ROLES_DIR="/usr/share/nginx/html/roles"; \
  mkdir -p "${MIG_WEB_ROLES_DIR}"; \
  INFINITO_PATH="$(pkgmgr path infinito)"; \
  INFINITO_ROLES_DIR="${INFINITO_PATH}/roles"; \
  test -d "${INFINITO_ROLES_DIR}"; \
  cp -a "${INFINITO_ROLES_DIR}/." "${MIG_WEB_ROLES_DIR}/"; \
  infinito build tree -s "${MIG_WEB_ROLES_DIR}"; \
  infinito build roles_list -o "${MIG_WEB_ROLES_DIR}/list.json"; \
  nginx -t

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
