#!/bin/bash
set -euo pipefail

NAT_TYPE="${NAT_TYPE:-full-cone}"
PUBLIC_IFACE="${PUBLIC_IFACE:-eth0}"
INTERNAL_IFACE="${INTERNAL_IFACE:-eth1}"

echo "[nat-gateway] Configuring $NAT_TYPE NAT"
echo "[nat-gateway] Public: $PUBLIC_IFACE, Internal: $INTERNAL_IFACE"

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Flush existing rules
iptables -t nat -F
iptables -F FORWARD

case "$NAT_TYPE" in
  full-cone)
    # Full Cone: any external host can reach the mapped port
    iptables -t nat -A POSTROUTING -o "$PUBLIC_IFACE" -j MASQUERADE
    iptables -A FORWARD -i "$INTERNAL_IFACE" -o "$PUBLIC_IFACE" -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" -j ACCEPT
    ;;

  address-restricted)
    # Address-Restricted: only hosts the internal host has sent to
    iptables -t nat -A POSTROUTING -o "$PUBLIC_IFACE" -j MASQUERADE
    iptables -A FORWARD -i "$INTERNAL_IFACE" -o "$PUBLIC_IFACE" -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" \
      -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" -j DROP
    ;;

  port-restricted)
    # Port-Restricted: only host:port the internal host has sent to
    # conntrack ESTABLISHED,RELATED enforces port restriction by default
    iptables -t nat -A POSTROUTING -o "$PUBLIC_IFACE" -j MASQUERADE
    iptables -A FORWARD -i "$INTERNAL_IFACE" -o "$PUBLIC_IFACE" -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" \
      -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" -j DROP
    ;;

  symmetric)
    # Symmetric: different mapping per destination + strict filtering
    # --random causes different source ports per destination
    iptables -t nat -A POSTROUTING -o "$PUBLIC_IFACE" -j MASQUERADE --random
    iptables -A FORWARD -i "$INTERNAL_IFACE" -o "$PUBLIC_IFACE" -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" \
      -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A FORWARD -i "$PUBLIC_IFACE" -o "$INTERNAL_IFACE" -j DROP
    ;;

  *)
    echo "[nat-gateway] Unknown NAT type: $NAT_TYPE"
    exit 1
    ;;
esac

echo "[nat-gateway] iptables rules applied for $NAT_TYPE"
iptables -t nat -L -n -v
iptables -L FORWARD -n -v

# Keep container running
exec tail -f /dev/null
