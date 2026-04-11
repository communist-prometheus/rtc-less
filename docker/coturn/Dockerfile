FROM coturn/coturn:alpine

COPY turnserver.conf /etc/coturn/turnserver.conf

EXPOSE 3478/udp 3478/tcp 5349/tcp
EXPOSE 49152-65535/udp

CMD ["turnserver", "-c", "/etc/coturn/turnserver.conf"]
