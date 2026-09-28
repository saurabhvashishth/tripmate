output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_az1" {
  value = aws_subnet.public_az1.id
}

output "public_subnet_az2" {
  value = aws_subnet.public_az2.id
}

output "private_subnet_az1" {
  value = aws_subnet.private_az1.id
}

output "private_subnet_az2" {
  value = aws_subnet.private_az2.id
}

output "igw_id" {
  value = aws_internet_gateway.igw.id
}

output "tgw_attachment_id" {
  value = aws_ec2_transit_gateway_vpc_attachment.tgw_attach.id
}

output "ec2_public_ip" {
  value = aws_instance.web.public_ip
}

output "ec2_instance_id" {
  value = aws_instance.web.id
}

output "key_pair_name" {
  value = aws_key_pair.ec2_key.key_name
}

output "private_key_path" {
  value     = local_sensitive_file.private_key.filename
  sensitive = true
}

output "eks_cluster_name" {
  value = aws_eks_cluster.main.name
}

output "eks_cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "eks_cluster_ca" {
  value     = aws_eks_cluster.main.certificate_authority[0].data
  sensitive = true
}
