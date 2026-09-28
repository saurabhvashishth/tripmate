variable "region" {
  default = "ap-south-1"
}

variable "profile" {
  default = "AWSAdministratorAccess-874718169236"
}

variable "vpc_cidr" {
  default = "192.10.128.0/20"
}

variable "vpc_id" {
  default = "vpc-0134e102a4dc91bff"
}

variable "tgw_id" {
  description = "Shared Transit Gateway ID"
  type        = string
  default     = "tgw-0cf2684373052f5bb"
}

variable "az1" {
  default = "ap-south-1a"
}

variable "az2" {
  default = "ap-south-1b"
}