#!/bin/bash
# MuchovhaOS — Single-command AWS deployment
# Reuses existing instance if one is already running.
# Usage: chmod +x aws-deploy.sh && ./aws-deploy.sh
set -e

export AWS_PAGER=""
REGION="us-east-1"
KEY_NAME="muchovhaos-key"
AMI="ami-0c7217cdde317cfec"  # Ubuntu 22.04 us-east-1
INSTANCE_TYPE="m7i-flex.large"
TAG_NAME="muchovhaos"

echo "Deploying MuchovhaOS to AWS..."

# Create key pair (skip if already exists)
if [ ! -f ${KEY_NAME}.pem ]; then
    aws ec2 create-key-pair --region $REGION --key-name $KEY_NAME \
        --query 'KeyMaterial' --output text > ${KEY_NAME}.pem
    chmod 400 ${KEY_NAME}.pem
    echo "Key pair created"
else
    echo "Key pair already exists, reusing"
fi

# Create security group
SG_ID=$(aws ec2 create-security-group --region $REGION \
    --group-name muchovhaos-sg --description "MuchovhaOS" \
    --query 'GroupId' --output text 2>/dev/null || \
    aws ec2 describe-security-groups --region $REGION \
    --group-names muchovhaos-sg --query 'SecurityGroups[0].GroupId' --output text)

aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID \
    --protocol tcp --port 22 --cidr 0.0.0.0/0 2>/dev/null || true
aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID \
    --protocol tcp --port 80 --cidr 0.0.0.0/0 2>/dev/null || true
aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID \
    --protocol tcp --port 443 --cidr 0.0.0.0/0 2>/dev/null || true

# Check for existing running instance
INSTANCE_ID=$(aws ec2 describe-instances --region $REGION \
    --filters "Name=tag:Name,Values=${TAG_NAME}" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null)

if [ "$INSTANCE_ID" != "None" ] && [ -n "$INSTANCE_ID" ]; then
    echo "Found existing instance: $INSTANCE_ID — reusing it"
else
    echo "No existing instance found — launching a new one..."
    INSTANCE_ID=$(aws ec2 run-instances --region $REGION \
        --image-id $AMI --instance-type $INSTANCE_TYPE \
        --key-name $KEY_NAME --security-group-ids $SG_ID \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${TAG_NAME}}]" \
        --query 'Instances[0].InstanceId' --output text)

    echo "Instance: $INSTANCE_ID — waiting for it to start..."
    aws ec2 wait instance-running --region $REGION --instance-ids $INSTANCE_ID
    echo "Waiting for SSH to be ready..."
    sleep 30
fi

IP=$(aws ec2 describe-instances --region $REGION --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "IP: $IP"

# Upload and deploy (exclude large dirs that Docker rebuilds anyway)
rsync -az --progress -e "ssh -i ${KEY_NAME}.pem -o StrictHostKeyChecking=no" \
    --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' \
    --exclude '.git' --exclude '*.pem' \
    "$(dirname "$0")/" ubuntu@${IP}:~/muchovhaos/

ssh -i ${KEY_NAME}.pem -o StrictHostKeyChecking=no ubuntu@${IP} \
    "cd muchovhaos && chmod +x deploy.sh && sudo docker stop muchovhaos 2>/dev/null; sudo docker rm muchovhaos 2>/dev/null; ./deploy.sh"

# Fetch the HTTPS URL from the server
HTTPS_URL=$(ssh -i ${KEY_NAME}.pem -o StrictHostKeyChecking=no ubuntu@${IP} \
    "sudo journalctl -u cloudflared --since '2 minutes ago' --no-pager 2>/dev/null | grep -o 'https://[^ |]*trycloudflare.com' | tail -1" 2>/dev/null || true)

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ MuchovhaOS is live!"
echo ""
echo "  HTTP:  http://${IP}"
if [ -n "$HTTPS_URL" ]; then
    echo "  HTTPS: ${HTTPS_URL}"
else
    echo "  HTTPS: (check with: ssh -i ${KEY_NAME}.pem ubuntu@${IP} 'sudo journalctl -u cloudflared | grep trycloudflare')"
fi
echo "═══════════════════════════════════════════════"
