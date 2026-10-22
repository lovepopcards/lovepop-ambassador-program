module "ecs-ambassador" {
  source           = "git::ssh://git@github.com/lovepopcards/terraform-module-ecs.git?ref=v0.0.12"
  region           = "us-west-2"
  yaml_config_path = "./prod.yaml"
  image_tag        = var.image_tag
}
