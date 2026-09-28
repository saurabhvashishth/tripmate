# Generate RSA key pair
resource "tls_private_key" "ec2_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "ec2_key" {
  key_name   = "main-ec2-key"
  public_key = tls_private_key.ec2_key.public_key_openssh
}

# Save private key locally
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.ec2_key.private_key_pem
  filename        = "${path.module}/main-ec2-key.pem"
  file_permission = "0400"
}

# Security Group - allow SSH
resource "aws_security_group" "ec2_sg" {
  name   = "ec2-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "ec2-sg" }
}

# EC2 Instance - Free tier (t2.micro), Amazon Linux 2023
resource "aws_instance" "web" {
  ami                    = "ami-0cad00db27cb1bcc2"
  instance_type          = "t3.medium"
  subnet_id              = aws_subnet.public_az1.id
  key_name               = aws_key_pair.ec2_key.key_name
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
    # Uses AWS managed default key (aws/ebs) when no kms_key_id is specified
  }

  tags = { Name = "main-ec2-instance" }
}
