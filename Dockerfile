FROM nginx:1.27-alpine

# Replace default Nginx site config with static-site settings for App Service.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy everything in the build context except ignored files (see .dockerignore).
COPY . /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]