# Build Stage
FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production Stage (Nginx)
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config if we had one, otherwise default works for simple static
# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
