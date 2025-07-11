FROM nginx:alpine

# Remove the default Nginx config and use your own
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/

WORKDIR /usr/share/nginx/html

# Copy static files
COPY index.html ./
