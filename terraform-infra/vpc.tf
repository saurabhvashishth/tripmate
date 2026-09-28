# VPC
/*
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "main-vpc" }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "main-igw" }
}

# Subnets
resource "aws_subnet" "public_az1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "192.10.136.0/27"
  availability_zone       = var.az1
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-az1" }
}

resource "aws_subnet" "public_az2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "192.10.136.32/27"
  availability_zone       = var.az2
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-az2" }
}

resource "aws_subnet" "private_az1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "192.10.128.0/22"
  availability_zone = var.az1
  tags              = { Name = "private-subnet-az1" }
}

resource "aws_subnet" "private_az2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "192.10.132.0/22"
  availability_zone = var.az2
  tags              = { Name = "private-subnet-az2" }
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = { Name = "public-rt" }
}

resource "aws_route_table_association" "public_az1" {
  subnet_id      = aws_subnet.public_az1.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_az2" {
  subnet_id      = aws_subnet.public_az2.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "private-rt" }
}

resource "aws_route_table_association" "private_az1" {
  subnet_id      = aws_subnet.private_az1.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_az2" {
  subnet_id      = aws_subnet.private_az2.id
  route_table_id = aws_route_table.private.id
}

# TGW Attachment
resource "aws_ec2_transit_gateway_vpc_attachment" "tgw_attach" {
  transit_gateway_id = var.tgw_id
  vpc_id             = aws_vpc.main.id
  subnet_ids         = [aws_subnet.private_az1.id, aws_subnet.private_az2.id]

  tags = { Name = "main-vpc-tgw-attachment" }
}
*/
# Subnet creation for Existing VPC

resource "aws_subnet" "public_az1" {
  vpc_id                  = var.vpc_id
  cidr_block              = "10.36.4.0/26"
  availability_zone       = var.az1
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-az1" }
}

resource "aws_subnet" "public_az2" {
  vpc_id                  = var.vpc_id
  cidr_block              = "10.36.4.64/26"
  availability_zone       = var.az2
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-az2" }
}

### ##