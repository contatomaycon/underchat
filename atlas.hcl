variable "DB_ATLAS" {
  type = string
}

data "external_schema" "drizzle" {
  program = [
    "pnpm",
    "drizzle-kit",
    "export"
  ]
}

env "dev" {
  dev = var.DB_ATLAS

  schema {
    src = data.external_schema.drizzle.url
  }

  migration {
    dir = "file://atlas/seed/dev"
  }
}

env "zipcode" {
  dev = var.DB_ATLAS

  schema {
    src = data.external_schema.drizzle.url
  }

  migration {
    dir = "file://atlas/seed/zipcode"
  }
}

env "prod" {
  dev = var.DB_ATLAS

  schema {
    src = data.external_schema.drizzle.url
  }

  migration {
    dir = "file://atlas/prod"
  }
}