FROM node:22-alpine
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9

WORKDIR /app

# Copy package info dan install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy sisa file dan build
COPY . .
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]
