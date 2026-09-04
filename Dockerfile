FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/10-mig-github.sh /docker-entrypoint.d/10-mig-github.sh
COPY src/ /usr/share/nginx/html/

RUN chmod +x /docker-entrypoint.d/10-mig-github.sh \
 && : > /etc/nginx/mig-github.conf

EXPOSE 80
