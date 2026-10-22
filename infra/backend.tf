terraform {
  backend "s3" {
  }
}
provider "aws" {
  region = "us-west-2"
}

terraform {
  required_version = ">=1.1.2"
}

variable "image_tag" {
  description = "The image tag for the Docker image to deploy"
  type        = string
}
